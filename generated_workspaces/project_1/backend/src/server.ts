import "dotenv/config";

import cors from "cors";
import express from "express";

import authRoutes from "./routes/auth.routes.js";
import incomeRoutes from "./routes/income.routes.js";
import expenseRoutes from "./routes/expense.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import budgetRoutes from "./routes/budget.routes.js";

const app = express();

const PORT = Number(
  process.env.PORT ?? 5000
);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
  });
});

app.use(
  "/api/auth",
  authRoutes
);
app.use(
  "/api/incomes",
  incomeRoutes
);
app.use(
  "/api/expenses",
  expenseRoutes
);
app.use(
  "/api/categories",
  categoryRoutes
);
app.use(
  "/api/budgets",
  budgetRoutes
);

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});