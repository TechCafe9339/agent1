import { Router } from "express";

import {
  createBudget,
  deleteBudget,
  getBudgetById,
  getBudgets,
  updateBudget,
} from "../controllers/budget.controller.js";

import {
  AuthMiddleware,
} from "../middleware/auth.middleware.js";


const router = Router();

router.use(
  AuthMiddleware
);

router.post(
  "/",
  createBudget
);

router.get(
  "/",
  getBudgets
);

router.get(
  "/:id",
  getBudgetById
);

router.put(
  "/:id",
  updateBudget
);

router.delete(
  "/:id",
  deleteBudget
);

export default router;