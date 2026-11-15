# ASTRAGRON — Product Flows Reference (`PRODUCT_FLOWS.md`)

See also [UX_AND_PAGE_ARCHITECTURE.md](./UX_AND_PAGE_ARCHITECTURE.md) for the complete route table and failure state matrix.

## Primary User Flow Diagram

```mermaid
flowchart LR
  A["/ Cinematic Landing"] --> B["/explore Earth Explorer"]
  A --> E["/farm/uppsala-demo/results M14 Demo"]
  B --> C["/farm/new 5-Step Setup Wizard"]
  B --> D["/farm/[id]/coverage M4 Readiness"]
  C --> D
  D --> F["/farm/[id]/analysis Preference Gate"]
  F --> E
  E --> G["/farm/[id]/plans 5-Year Matrix"]
  E --> H["/farm/[id]/climate ECharts & Table"]
  E --> I["/farm/[id]/decisions Pareto & Regret"]
  E --> J["/farm/[id]/evidence Provenance Drawer"]
  E --> K["/farm/[id]/reports JSON/CSV & Print"]
```
