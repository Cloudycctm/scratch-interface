// This needs to be in an import so that it runs before the RLBotExt import
import "./init-scratch-global.ts";
import RLBotExt, { EXT_ID } from "../../plugin/src/plugin.ts";
export { RLBotExt, EXT_ID };
