# Folder navigation documentation design

## Purpose

The repository README explains how to use bxios. The local READMEs added in this change form a navigation layer: each states a folder's responsibility, lists tracked direct contents, and links to the package, implementation, tests, design notes, or E2E context that answers the next question. Generated output and dependencies are intentionally outside this layer.

## High-level design

```mermaid
flowchart TD
  Root[Repository README] --> Docs[docs README]
  Root --> E2E[e2e README]
  Root --> Example[examples/react-bxios README]
  Root --> Wire[packages/wire README]
  Root --> Client[packages/bxios README]
  Root --> Server[packages/server README]
  Wire --> WireSource[wire/src README]
  Client --> ClientSource[bxios/src README]
  Server --> ServerSource[server/src README]
  Example --> ExampleSource[react-bxios/src README]
```

## Low-level design

```mermaid
flowchart LR
  PackageREADME[Package README] --> SourceREADME[src README]
  PackageREADME --> TestREADME[test README]
  PackageREADME --> DesignREADME[docs README]
  SourceREADME --> TrackedModules[Tracked direct modules]
  TestREADME --> TrackedTests[Tracked direct tests]
  DesignREADME --> TrackedNotes[Tracked direct design notes]
  SourceREADME --> NeighborPackage[Relevant sibling package README]
```

## Class/interface model

```mermaid
classDiagram
  class DirectoryREADME {
    <<document>>
    +responsibility: string
    +trackedContents: list
    +navigationLinks: list
  }
  class PackageREADME {
    <<document>>
  }
  class SourceREADME {
    <<document>>
  }
  class TestREADME {
    <<document>>
  }
  class DesignREADME {
    <<document>>
  }
  DirectoryREADME <|-- PackageREADME
  DirectoryREADME <|-- SourceREADME
  DirectoryREADME <|-- TestREADME
  DirectoryREADME <|-- DesignREADME
  PackageREADME --> SourceREADME : links to
  PackageREADME --> TestREADME : links to
  PackageREADME --> DesignREADME : links to
```

## Navigation sequence

```mermaid
sequenceDiagram
  actor Reader
  participant Root as Repository README
  participant Package as Package README
  participant Source as src README
  participant Tests as test README
  participant Design as docs README
  Reader->>Root: choose package or workflow
  Root-->>Reader: link to local README
  Reader->>Package: inspect responsibility and contents
  Package-->>Reader: source, test, and docs links
  opt implementation question
    Reader->>Source: inspect module map
  end
  opt behavior question
    Reader->>Tests: inspect test scope
  end
  opt architecture question
    Reader->>Design: inspect design notes
  end
```

## Maintenance rule

When a tracked direct file or meaningful direct subdirectory is added, renamed, or removed, update that folder's README in the same change. Keep generated outputs and dependency directories out of this navigation layer.
