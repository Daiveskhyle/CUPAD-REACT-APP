import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
  AxiosResponse,
} from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL } from "../src/config/config";

/**
 * CUPAD API Client
 *
 * Responsibilities:
 * - Connect to CUPAD PHP API
 * - Automatically attach JWT
 * - Handle expired authentication
 * - Provide consistent error messages
 * - Support offline-aware API calls
 */

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

// =====================================================
// REQUEST INTERCEPTOR
// =====================================================

api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    try {
      const token = await AsyncStorage.getItem("cupad_jwt");

      if (token) {
        const headers = config.headers ?? {};

        if (typeof (headers as any).set === "function") {
          (headers as any).set("Authorization", `Bearer ${token}`);
        } else {
          (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
        }

        config.headers = headers;
      }
    } catch (error) {
      console.error("CUPAD: Failed to load JWT", error);
    }

    return config;
  },

  (error) => {
    return Promise.reject(error);
  }
);

// =====================================================
// RESPONSE INTERCEPTOR
// =====================================================

api.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },

  async (error: AxiosError<any>) => {
    const status = error.response?.status;

    // -------------------------------------------------
    // JWT expired / invalid
    // -------------------------------------------------

    if (status === 401) {
      try {
        await AsyncStorage.multiRemove([
          "cupad_jwt",
          "cupad_user",
          "cupad_role",
        ]);

        /**
         * DO NOT remove:
         *
         * cupad_last_login
         *
         * The login screen needs this to show
         * "Continue as last user".
         */
      } catch (storageError) {
        console.error(
          "CUPAD: Failed to clear authentication",
          storageError
        );
      }
    }

    return Promise.reject(error);
  }
);

// =====================================================
// API ERROR HELPER
// =====================================================

export function getApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data;

    if (typeof responseData?.message === "string") {
      return responseData.message;
    }

    if (typeof responseData?.error === "string") {
      return responseData.error;
    }

    if (error.code === "ECONNABORTED") {
      return "The request timed out. Please try again.";
    }

    if (!error.response) {
      return "Unable to connect to CUPAD. Check your internet connection.";
    }

    switch (error.response.status) {
      case 400:
        return "Invalid request.";

      case 401:
        return "Your session has expired. Please log in again.";

      case 403:
        return "You do not have permission to perform this action.";

      case 404:
        return "The requested CUPAD resource was not found.";

      case 409:
        return "This transaction already exists.";

      case 422:
        return "Some of the information provided is invalid.";

      case 429:
        return "Too many requests. Please wait and try again.";

      case 500:
        return "CUPAD server error. Please try again later.";

      default:
        return `Request failed with status ${error.response.status}.`;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected error occurred.";
}

// =====================================================
// AUTH HELPERS
// =====================================================

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem("cupad_jwt");
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getToken();

  return Boolean(token);
}

export async function clearAuthentication(): Promise<void> {
  await AsyncStorage.multiRemove([
    "cupad_jwt",
    "cupad_user",
    "cupad_role",
  ]);
}

// =====================================================
// ONLINE CHECK
// =====================================================

export async function checkApiConnection(): Promise<boolean> {
  try {
    await api.get("/health", {
      timeout: 5000,
    });

    return true;
  } catch {
    return false;
  }
}

// =====================================================
// LOGIN
// =====================================================

export interface LoginUser {
  id: number;
  username: string;
  role: string;
  full_name?: string;
  name?: string;
  profile_pic?: string;
  branch_id?: string | number;
  area_id?: string | number;
  zone_id?: string | number;
  email?: string;
  phone?: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  user?: LoginUser;
  message?: string;
}

export async function login(
  username: string,
  password: string
): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>("/login", {
    username: username.trim(),
    password,
  });

  return response.data;
}

// =====================================================
// DASHBOARD
// =====================================================

export async function getDashboardStats() {
  const response = await api.get("/dashboard/stats");

  return response.data;
}

// =====================================================
// CLIENTS
// =====================================================

export async function getClients(params?: Record<string, any>) {
  const response = await api.get("/clients", {
    params,
  });

  return response.data;
}

export async function getClient(clientId: string | number) {
  const response = await api.get(`/clients/${clientId}`);

  return response.data;
}

// =====================================================
// SAVINGS
// =====================================================

export async function saveSavings(data: {
  client_id: string | number;
  amount: number;
  collection_date: string;
  transaction_id?: string;
}) {
  const response = await api.post("/savings/collect", data);

  return response.data;
}

// =====================================================
// COMBINE
// =====================================================

export async function saveCombine(data: {
  client_id: string | number;
  amount: number;
  transaction_date: string;
  transaction_id?: string;
}) {
  const response = await api.post("/combine", data);

  return response.data;
}

// =====================================================
// OFFLINE SYNC
// =====================================================

export interface SyncPayload {
  sync_id: string;
  entity: string;
  entity_id: string;
  operation: string;
  payload: unknown;
}

export async function syncTransaction(
  data: SyncPayload
) {
  const response = await api.post("/sync", data);

  return response.data;
}

// =====================================================
// GENERIC REQUEST HELPERS
// =====================================================

export async function apiGet<T = any>(
  url: string,
  params?: Record<string, any>
): Promise<T> {
  const response = await api.get<T>(url, {
    params,
  });

  return response.data;
}

export async function apiPost<T = any>(
  url: string,
  data?: any
): Promise<T> {
  const response = await api.post<T>(url, data);

  return response.data;
}

export async function apiPut<T = any>(
  url: string,
  data?: any
): Promise<T> {
  const response = await api.put<T>(url, data);

  return response.data;
}

export async function apiDelete<T = any>(
  url: string
): Promise<T> {
  const response = await api.delete<T>(url);

  return response.data;
}

// =====================================================
// DEFAULT EXPORT
// =====================================================

export default api;