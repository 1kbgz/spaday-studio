from pathlib import Path

from spaday import ComponentPackage

from .access import StudioAccessContext, StudioAuthorizer, StudioRole
from .catalog import ComponentCatalog, ComponentSchema, ComponentSummary, PropertySchema, discover_catalog
from .models import (
    InsertNode,
    MoveNode,
    RemoveNode,
    SetBinding,
    SetEvent,
    SetKey,
    SetProp,
    SetState,
    SetTitle,
    StudioDocument,
    StudioNode,
    UnsetBinding,
    UnsetEvent,
    UnsetKey,
    UnsetProp,
    UnsetState,
    document_schema,
    operation_batch_schema,
    operation_schema,
)
from .project import ProjectFile, export_python
from .session import PreviewConflict, RevisionConflict, StudioSession, StudioState

__version__ = "0.1.0"

package = ComponentPackage(
    name="studio",
    assets_dir=Path(__file__).parent / "extension",
    assets=(("css", "css/index.css"), ("js", "cdn/index.js")),
)

__all__ = [
    "ComponentCatalog",
    "ComponentSchema",
    "ComponentSummary",
    "InsertNode",
    "MoveNode",
    "PreviewConflict",
    "ProjectFile",
    "PropertySchema",
    "RemoveNode",
    "RevisionConflict",
    "SetBinding",
    "SetEvent",
    "SetKey",
    "SetProp",
    "SetState",
    "SetTitle",
    "StudioAccessContext",
    "StudioAuthorizer",
    "StudioDocument",
    "StudioNode",
    "StudioRole",
    "StudioSession",
    "StudioState",
    "UnsetBinding",
    "UnsetEvent",
    "UnsetKey",
    "UnsetProp",
    "UnsetState",
    "discover_catalog",
    "document_schema",
    "export_python",
    "operation_batch_schema",
    "operation_schema",
    "package",
]
