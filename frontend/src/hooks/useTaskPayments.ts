import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../services/api";

export interface TaskPayment {
  nodeId: string;
  agentName: string;
  capability: string | null;
  amountXLM: number;
  txHash: string | null;
  status: "released" | "locked" | "refunded";
  createdAt?: string;
}

interface TaskPaymentsResponse {
  taskId: string;
  completionTimestamp: string | null;
  prompt: string;
  payments: TaskPayment[];
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatPaymentTimestamp(value: string) {
  return dateFormatter.format(new Date(value));
}

export function useTaskPayments(
  taskId: string | undefined,
  wallet: string | null,
) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["task-payments", taskId, wallet],
    enabled: Boolean(taskId && wallet),
    retry: false,
    queryFn: ({ signal }) =>
      apiClient.get<TaskPaymentsResponse>(
        `/api/tasks/${encodeURIComponent(taskId ?? "")}/payments`,
        { signal, headers: { walletpublickey: wallet ?? "" } },
      ),
  });
  const payments = data?.payments ?? [];
  const totalXLM = payments.reduce(
    (total, payment) =>
      payment.status === "released" ? total + payment.amountXLM : total,
    0,
  );
  return { receipt: data, payments, totalXLM, isLoading, error };
}
