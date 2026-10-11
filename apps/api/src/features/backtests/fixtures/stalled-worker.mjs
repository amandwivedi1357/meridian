// A deliberately stalled subprocess for timeout/shutdown integration checks.
import { setInterval } from "node:timers";
setInterval(() => {}, 1000);
