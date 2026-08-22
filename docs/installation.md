---
title: Installation
description: Import the solution and make the control available.
order: 2
---

# Installation

:::steps
1. Download the **managed** solution for your environment.
2. In the Power Platform admin centre, import the solution.
3. Publish all customizations.
4. Enable **Code components for canvas apps** if this control is used there.
:::

:::callout{type=warning}
Import the managed solution into production. The unmanaged one is for a
development environment where you intend to change the control itself — it
cannot be cleanly uninstalled.
:::

## Requirements

Nothing beyond the platform. Compact List declares no `<feature-usage>` at all,
so importing it asks for no Web API, device or navigation permission — the
import dialog has no consent step to read.

It renders with plain DOM rather than React, so it carries no dependency on the
platform's React or Fluent libraries and no minimum tied to them. The solution
targets the standard code-component runtime available in every supported
Dataverse environment.

## Where it goes

Compact List binds a **dataset**, so on a model-driven form it is added to a
subgrid, not to a field. See [Model-driven apps](model-driven.md) for the
steps, and [Canvas apps](canvas.md) for the `Items` binding.
