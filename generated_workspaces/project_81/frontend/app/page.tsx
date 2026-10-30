"use client";

import { useState } from 'react';

export default function Home() {
  const [count, setCount] = useState(0);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100">
      <h1 className="text-4xl font-bold mb-8">Counter App</h1>
      <div className="bg-white p-8 rounded-lg shadow-md w-64 text-center">
        <p className="text-3xl font-bold mb-6 count-display">{count}</p>
        <div className="space-x-4">
          <button
            onClick={() => setCount(count + 1)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Increment
          </button>
          <button
            onClick={() => setCount(0)}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}