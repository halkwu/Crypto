Angular UI demo for unified BTC/ETH/SOL frontend.

Overview
- Single UI where BTC/ETH/SOL are parameters (not separate pages).
- Components: chain selector, feature tabs (history/transfer), history list, transfer form.
- Frontend calls a unified REST API (see ../api).

Quick start (prototype):
1. Install Angular CLI globally (if not present):

```powershell
npm install -g @angular/cli
```

2. From `angular-ui` install deps and run:

```powershell
cd angular-ui
npm install
ng serve --open
```

3. Start API server (example):

```powershell
cd ..\api
npm install
npm run start
```

Notes
- This is a minimal scaffold; to run it as a real Angular app, run `ng new` or integrate these files into an Angular workspace. The code shows recommended component/service structure and the unified REST endpoints.
