'use client';

import { useState, useEffect } from 'react';

export default function Dashboard() {
  const [data, setData] =
    useState<string[]>([]);

  useEffect(() => {
    // Replace with actual data fetching logic
    setData(['Item 1', 'Item 2']);
  }, []);

  return (
    <div>
      <h1>Dashboard</h1>
      <ul>
        {data.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}