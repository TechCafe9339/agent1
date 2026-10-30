import { prisma } from '../config/prisma.js';

export const incrementCounter = async (currentValue: number): Promise<number> => {
  const counter = await prisma.counter.update({
    where: { id: 1 },
    data: { value: currentValue + 1 }
  });
  return counter.value;
};

export const decrementCounter = async (currentValue: number): Promise<number> => {
  const counter = await prisma.counter.update({
    where: { id: 1 },
    data: { value: currentValue - 1 }
  });
  return counter.value;
};

export const resetCounter = async (): Promise<number> => {
  const counter = await prisma.counter.update({
    where: { id: 1 },
    data: { value: 0 }
  });
  return counter.value;
};