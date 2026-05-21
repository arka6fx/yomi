import { default as base } from "./index.js";
import nextPlugin from "eslint-config-next";

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [...base, ...nextPlugin];
