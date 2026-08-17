"""Runnable Studio pilot document."""

from __future__ import annotations

from .models import StudioDocument, StudioNode


def node(id: str, tag: str, *, props: dict | None = None, children: list[StudioNode] | None = None) -> StudioNode:
    """Build one compact example document node."""
    return StudioNode(id=id, tag=tag, props=props or {}, slots={"default": children or []})


document = StudioDocument(
    title="Orbit operations",
    root=node(
        "app",
        "main",
        props={
            "style": (
                "min-height: 100%; box-sizing: border-box; padding: 3.5rem; color: #edf4ff; "
                "font-family: Inter, ui-sans-serif, system-ui; background: radial-gradient(circle at 20% 0%, #23345f, #0b1020 48%)"
            )
        },
        children=[
            node(
                "eyebrow",
                "p",
                props={
                    "textContent": "LIVE MISSION CONTROL",
                    "style": "margin: 0 0 0.75rem; color: #7dd3fc; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.18em",
                },
            ),
            node(
                "headline",
                "h1",
                props={
                    "textContent": "Build the interface while it is running.",
                    "style": "max-width: 760px; margin: 0; font-size: clamp(2.5rem, 6vw, 5.5rem); line-height: 0.96; letter-spacing: -0.055em",
                },
            ),
            node(
                "intro",
                "p",
                props={
                    "textContent": "Select any element, edit its properties, and watch spaday patch the live component tree without remounting the page.",
                    "style": "max-width: 680px; margin: 1.5rem 0 2.5rem; color: #a9b8d4; font-size: 1.05rem; line-height: 1.7",
                },
            ),
            node(
                "metrics",
                "section",
                props={"style": "display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; max-width: 920px"},
                children=[
                    node(
                        "metric-latency",
                        "article",
                        props={
                            "textContent": "18 ms\nPATCH LATENCY",
                            "style": "white-space: pre-line; padding: 1.4rem; border: 1px solid #314366; border-radius: 18px; background: #111a30cc; font-size: 1.35rem; line-height: 1.7",
                        },
                    ),
                    node(
                        "metric-revision",
                        "article",
                        props={
                            "textContent": "REV 0\nAUTHORITATIVE STATE",
                            "style": "white-space: pre-line; padding: 1.4rem; border: 1px solid #314366; border-radius: 18px; background: #111a30cc; font-size: 1.35rem; line-height: 1.7",
                        },
                    ),
                    node(
                        "metric-agents",
                        "article",
                        props={
                            "textContent": "MCP\nAGENT READY",
                            "style": "white-space: pre-line; padding: 1.4rem; border: 1px solid #314366; border-radius: 18px; background: #111a30cc; font-size: 1.35rem; line-height: 1.7",
                        },
                    ),
                ],
            ),
        ],
    ),
)


if __name__ == "__main__":
    import uvicorn

    from .server import create_app

    uvicorn.run(create_app(document), host="127.0.0.1", port=8020)
