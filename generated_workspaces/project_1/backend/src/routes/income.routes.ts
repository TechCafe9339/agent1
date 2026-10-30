import { Router } from "express";

import {
  createIncome,
  deleteIncome,
  getIncomeById,
  getIncomes,
  updateIncome,
} from "../controllers/income.controller.js";

import {
  AuthMiddleware,
} from "../middleware/auth.middleware.js";


const router = Router();

router.use(AuthMiddleware);

router.get(
  "/",
  getIncomes
);

router.get(
  "/:id",
  getIncomeById
);

router.post(
  "/",
  createIncome
);

router.put(
  "/:id",
  updateIncome
);

router.delete(
  "/:id",
  deleteIncome
);

export default router;