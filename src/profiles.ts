import type { Capability } from "./capabilities.ts";
import {
  biomeFormatting,
  biomeLinting,
  bunTesting,
  forgeLinting,
  forgeTypecheck,
  noTesting,
  tscTypecheck,
} from "./capabilities.ts";

export const PROFILES: Record<string, Capability[]> = {
  library: [tscTypecheck(), biomeLinting(), biomeFormatting(), bunTesting()],
  "forge-app": [
    forgeTypecheck(),
    forgeLinting(),
    biomeFormatting(),
    bunTesting(),
  ],
  tool: [tscTypecheck(), biomeLinting(), biomeFormatting(), bunTesting()],
  "agent-skill": [
    tscTypecheck(),
    biomeLinting(),
    biomeFormatting(),
    noTesting(),
  ],
};

export type ProjectProfile = keyof typeof PROFILES;
