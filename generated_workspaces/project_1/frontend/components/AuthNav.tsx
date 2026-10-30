"use client";

import Link from "next/link";
import {
  useEffect,
  useState,
} from "react";

import LogoutButton from "./LogoutButton";

export default function AuthNav() {
  const [loggedIn, setLoggedIn] =
    useState(false);

  useEffect(() => {
    const token =
      localStorage.getItem("token");

    setLoggedIn(
      Boolean(token)
    );
  }, []);

  if (loggedIn) {
    return (
      <LogoutButton />
    );
  }

  return (
    <>
      <Link href="/login">
        Login
      </Link>

      <Link href="/register">
        Register
      </Link>
    </>
  );
}