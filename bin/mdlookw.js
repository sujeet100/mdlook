#!/usr/bin/env node
// Window-mode entry point: a real second bin (not argv-name sniffing, which
// breaks under npm's Windows shims).
process.argv.splice(2, 0, '-w');
await import('./mdlook.js');
