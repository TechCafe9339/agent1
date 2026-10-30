import type { Response } from "express";

import { prisma } from "../config/prisma.js";
import type {
  AuthenticatedRequest,
} from "../middleware/auth.middleware.js";


export async function createIncome(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({
        error: "Unauthorized",
      });
      return;
    }

    const {
      categoryId,
      amount,
      date,
      description,
    } = req.body;

    if (
      !categoryId ||
      amount === undefined ||
      !date ||
      typeof description !== "string"
    ) {
      res.status(400).json({
        error:
          "categoryId, amount, date and description are required",
      });
      return;
    }

    const income = await prisma.income.create({
      data: {
        userId,
        categoryId: Number(categoryId),
        amount: Number(amount),
        date: new Date(date),
        description,
      },
    });

    res.status(201).json(income);
  } catch (error) {
    console.error(
      "Create income failed:",
      error
    );

    res.status(500).json({
      error: "Unable to create income",
    });
  }
}


export async function getIncomes(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({
        error: "Unauthorized",
      });
      return;
    }

    const incomes =
      await prisma.income.findMany({
        where: {
          userId,
        },
        include: {
          category: true,
        },
        orderBy: {
          date: "desc",
        },
      });

    res.json(incomes);
  } catch (error) {
    console.error(
      "Get incomes failed:",
      error
    );

    res.status(500).json({
      error: "Unable to retrieve incomes",
    });
  }
}


export async function getIncomeById(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.userId;
    const id = Number(req.params.id);

    if (!userId) {
      res.status(401).json({
        error: "Unauthorized",
      });
      return;
    }

    if (!Number.isInteger(id)) {
      res.status(400).json({
        error: "Invalid income ID",
      });
      return;
    }

    const income =
      await prisma.income.findFirst({
        where: {
          id,
          userId,
        },
        include: {
          category: true,
        },
      });

    if (!income) {
      res.status(404).json({
        error: "Income not found",
      });
      return;
    }

    res.json(income);
  } catch (error) {
    console.error(
      "Get income failed:",
      error
    );

    res.status(500).json({
      error: "Unable to retrieve income",
    });
  }
}


export async function updateIncome(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.userId;
    const id = Number(req.params.id);

    if (!userId) {
      res.status(401).json({
        error: "Unauthorized",
      });
      return;
    }

    const existing =
      await prisma.income.findFirst({
        where: {
          id,
          userId,
        },
      });

    if (!existing) {
      res.status(404).json({
        error: "Income not found",
      });
      return;
    }

    const {
      categoryId,
      amount,
      date,
      description,
    } = req.body;

    const income =
      await prisma.income.update({
        where: {
          id,
        },
        data: {
          ...(categoryId !== undefined && {
            categoryId: Number(categoryId),
          }),

          ...(amount !== undefined && {
            amount: Number(amount),
          }),

          ...(date !== undefined && {
            date: new Date(date),
          }),

          ...(description !== undefined && {
            description,
          }),
        },
      });

    res.json(income);
  } catch (error) {
    console.error(
      "Update income failed:",
      error
    );

    res.status(500).json({
      error: "Unable to update income",
    });
  }
}


export async function deleteIncome(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.userId;
    const id = Number(req.params.id);

    if (!userId) {
      res.status(401).json({
        error: "Unauthorized",
      });
      return;
    }

    const existing =
      await prisma.income.findFirst({
        where: {
          id,
          userId,
        },
      });

    if (!existing) {
      res.status(404).json({
        error: "Income not found",
      });
      return;
    }

    await prisma.income.delete({
      where: {
        id,
      },
    });

    res.status(204).send();
  } catch (error) {
    console.error(
      "Delete income failed:",
      error
    );

    res.status(500).json({
      error: "Unable to delete income",
    });
  }
}