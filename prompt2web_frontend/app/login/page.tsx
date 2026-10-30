"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        "http://127.0.0.1:8000/api/auth/login/",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username,
            password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ?? "Login failed."
        );
      }

      localStorage.setItem(
        "token",
        data.token
      );

      localStorage.setItem(
        "user",
        JSON.stringify(data.user)
      );

      window.location.href = "/";
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Login failed."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">
            Prompt2Web
          </h1>

          <p className="mt-2 text-slate-400">
            Sign in to continue building.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5"
        >
          <div>
            <label className="mb-2 block text-sm text-slate-300">
              Username
            </label>

            <input
              type="text"
              value={username}
              onChange={(event) =>
                setUsername(event.target.value)
              }
              placeholder="Enter username"
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-slate-300">
              Password
            </label>

            <input
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              placeholder="Enter password"
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {loading
              ? "Signing in..."
              : "Sign In"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-blue-400 hover:text-blue-300"
          >
            Create account
          </Link>
        </p>
      </div>
    </main>
  );
}