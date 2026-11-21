import { Horizon } from "@stellar/stellar-sdk";
import { getRequestId, REQUEST_ID_HEADER } from "../utils/requestContext";

let tracingInstalled = false;

export function createHorizonServer(url: string): Horizon.Server {
  // All Horizon Server methods and call builders share this SDK HTTP client.
  if (!tracingInstalled && Horizon.AxiosClient) {
    Horizon.AxiosClient.interceptors.request.use((config) => {
      const requestId = getRequestId();
      if (requestId) config.headers.set(REQUEST_ID_HEADER, requestId);
      return config;
    });
    tracingInstalled = true;
  }
  return new Horizon.Server(url);
}
