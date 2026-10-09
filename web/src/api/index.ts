import type { ApiClient } from "./client";
import { createHttpClient } from "./http";
import { MockEngine } from "./mock/engine";

export const isMock = import.meta.env.VITE_MOCK === "1";

export const api: ApiClient = isMock ? new MockEngine() : createHttpClient();
