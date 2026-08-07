import createClient from "openapi-fetch";
import type { paths } from "./generated/schema";
import { runtimeConfig } from "../config/runtime";

export const apiClient = createClient<paths>({ baseUrl: runtimeConfig.apiBaseUrl });

apiClient.use({
  async onRequest({ request }) {
    const token = await runtimeConfig.getAuthToken();
    if (token) {
      request.headers.set("Authorization", `Bearer ${token}`);
    }
    return request;
  },
  async onResponse({ response }) {
    if (response.status === 401) {
      await runtimeConfig.onUnauthorized();
    }
    return response;
  },
});
