import * as Explicame from "./index.js";

// The app's own <script> tag and the recorder may both load the bundle: the first instance stays, so there is
// always a single player.
const host = window as unknown as { Explicame?: typeof Explicame };
host.Explicame ??= Explicame;
