"""ASGI host for the Studio canvas, transports mirror, and MCP endpoint."""

from __future__ import annotations

import argparse
import asyncio
import html
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager, suppress
from pathlib import Path

import transports
from pydantic import ValidationError
from spaday import resolve_component_packages
from spaday.backends.starlette import mount
from spaday.packages import package_url_prefix

from .catalog import discover_catalog
from .example import document as example_document
from .mcp import create_mcp
from .models import StudioDocument
from .project import ProjectFile
from .session import PreviewConflict, RevisionConflict, StudioSession

HERE = Path(__file__).parent


def _expand_package_references(packages: Sequence[str]) -> tuple[str, ...]:
    references = tuple(packages)
    if "*" not in references:
        return references
    explicit = tuple(reference for reference in references if reference != "*")
    return (*explicit, *(name for name in discover_catalog().available_packages if name not in explicit))


def create_app(
    document: StudioDocument | None = None,
    *,
    project_path: str | Path | None = None,
    packages: Sequence[str] = (),
):
    """Create the pilot ASGI application for ``document``."""
    from starlette.applications import Starlette
    from starlette.responses import HTMLResponse, JSONResponse, PlainTextResponse
    from starlette.routing import Mount, Route, WebSocketRoute

    project_file = ProjectFile(project_path) if project_path is not None else None
    initial_document = document or example_document.model_copy(deep=True)
    if project_file is not None:
        if project_file.path.exists():
            initial_document = project_file.load()
        else:
            project_file.save(initial_document)
    studio = StudioSession(initial_document, save_document=project_file.save if project_file is not None else None)
    package_references = _expand_package_references(packages)
    selected_packages = resolve_component_packages(package_references)
    component_catalog = discover_catalog(list(package_references))
    package_tags = []
    for selected_package in selected_packages:
        prefix = package_url_prefix(selected_package)
        for kind, path in selected_package.assets:
            url = html.escape(f"{prefix}/{path}", quote=True)
            package_tags.append(f'<link rel="stylesheet" href="{url}" />' if kind == "css" else f'<script type="module" src="{url}"></script>')
    studio_html = (HERE / "index.html").read_text(encoding="utf-8").replace("<!-- component-packages -->", "\n    ".join(package_tags))
    transport_session = transports.Session()
    model_id = transport_session.host(studio.state)
    broadcaster = transports.Server(transport_session)
    mcp = create_mcp(studio, component_catalog)
    mcp_app = mcp.streamable_http_app(streamable_http_path="/")

    async def project(_request):
        return JSONResponse({"model_id": model_id, **studio.snapshot()})

    async def homepage(_request):
        return HTMLResponse(studio_html)

    async def catalog(_request):
        return JSONResponse(component_catalog.model_dump(mode="json"))

    async def python_export(_request):
        return PlainTextResponse(
            studio.python_source(),
            media_type="text/x-python",
            headers={"content-disposition": 'attachment; filename="spaday_app.py"'},
        )

    async def operations(request):
        try:
            body = await request.json()
            result = studio.apply(body["expected_revision"], body["operations"])
        except (KeyError, IndexError, TypeError, ValueError, ValidationError) as error:
            status = 409 if isinstance(error, (RevisionConflict, PreviewConflict)) else 422
            return JSONResponse({"error": str(error)}, status_code=status)
        return JSONResponse(result)

    @asynccontextmanager
    async def lifespan(_app: Starlette) -> AsyncIterator[None]:
        sync_task = asyncio.create_task(transports.autosync(broadcaster))
        try:
            async with mcp.session_manager.run():
                yield
        finally:
            sync_task.cancel()
            with suppress(asyncio.CancelledError):
                await sync_task

    app = Starlette(lifespan=lifespan)
    mount(
        app,
        studio.render,
        html=HERE / "index.html",
        layout="installed",
        packages=["spaday_studio:package", *selected_packages],
        routes=[
            WebSocketRoute("/ws", transports.ws_endpoint(broadcaster)),
            Route("/api/project", project),
            Route("/api/catalog", catalog),
            Route("/api/export/python", python_export),
            Route("/api/operations", operations, methods=["POST"]),
        ],
        title="spaday Studio",
    )
    app.routes.insert(0, Route("/", homepage))
    app.routes.append(Mount("/mcp", app=mcp_app))
    app.state.studio = studio
    app.state.model_id = model_id
    return app


def main() -> None:
    """Run the Studio pilot development server."""
    parser = argparse.ArgumentParser(description="Run the spaday Studio pilot")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8020, type=int)
    parser.add_argument("--project", type=Path, help="load or create a durable Studio JSON project")
    parser.add_argument(
        "--package",
        action="append",
        default=[],
        help="select an installed spaday component package (repeatable; quote '*' to select all)",
    )
    args = parser.parse_args()

    import uvicorn

    uvicorn.run(create_app(project_path=args.project, packages=args.package), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
