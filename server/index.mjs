import { createHostedServer, hostedConfig } from './hosted.mjs';

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const server = createHostedServer(hostedConfig());
server.listen(port, '127.0.0.1', () => console.log(`Ledger development API listening on port ${port}.`));
