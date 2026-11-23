import { createHostedHandler, hostedConfig } from '../server/hosted.mjs';

const handler = createHostedHandler(hostedConfig());
export default handler;
