Unified API example

This small Express server demonstrates the unified REST API that the Angular UI calls.

Endpoints
- GET /api/v1/txs?chain=BTC|ETH|SOL&account=...&limit=20
- POST /api/v1/transfer  { chain, fromAccount, to, amount, fee? }

Run:
```powershell
cd api
npm install
npm run start
```

The server runs on port 3000 by default.
