const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:5000/api";


export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {

  const headers = new Headers(
    options.headers
  );

  headers.set(
    "Content-Type",
    "application/json"
  );

  if (typeof window !== "undefined") {
    const token =
      localStorage.getItem("token");

    if (token) {
      headers.set(
        "Authorization",
        `Bearer ${token}`
      );
    }
  }

  const response = await fetch(
    `${API_BASE_URL}${path}`,
    {
      ...options,
      headers,
    }
  );

  if (!response.ok) {
    let message =
      `Request failed with status ${response.status}`;

    try {
      const data = await response.json();

      if (
        data &&
        typeof data === "object" &&
        "error" in data
      ) {
        message = String(data.error);
      }

    } catch {
      // Ignore invalid JSON error body.
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}


export function apiGet<T>(
  path: string
): Promise<T> {
  return apiRequest<T>(
    path,
    {
      method: "GET",
    }
  );
}


export function apiPost<T>(
  path: string,
  body: unknown
): Promise<T> {
  return apiRequest<T>(
    path,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

// async function handleDelete(
//   id: number
// ) {
//   try {
//       setError(null);

//       await apiDelete<void>(
//         `/incomes/${id}`
//       );

//       await loadData();

//   } catch (error) {
//       setError(
//         error instanceof Error
//           ? error.message
//           : "Failed to delete income"
//       );
//   }
// }


export function apiPut<T>(
  path: string,
  body: unknown
): Promise<T> {
  return apiRequest<T>(
    path,
    {
      method: "PUT",
      body: JSON.stringify(body),
    }
  );
}


export function apiDelete<T>(
  path: string
): Promise<T> {
  return apiRequest<T>(
    path,
    {
      method: "DELETE",
    }
  );
}