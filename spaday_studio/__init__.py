from pathlib import Path

from spaday import ComponentPackage

from .catalog import ComponentCatalog, ComponentSchema, ComponentSummary, PropertySchema, discover_catalog
from .models import (
    InsertNode,
    MoveNode,
    RemoveNode,
    SetProp,
    StudioDocument,
    StudioNode,
    UnsetProp,
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
    "SetProp",
    "StudioDocument",
    "StudioNode",
    "StudioSession",
    "StudioState",
    "UnsetProp",
    "discover_catalog",
    "export_python",
    "package",
]
