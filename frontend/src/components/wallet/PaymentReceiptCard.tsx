import { useToast } from "../../hooks/useToast";
import {
  formatPaymentTimestamp,
  type TaskPayment,
} from "../../hooks/useTaskPayments";

const statusStyles = {
  released: { label: "Confirmed", color: "var(--status-success-text)" },
  locked: { label: "Pending", color: "var(--status-warning-text)" },
  refunded: { label: "Failed (refunded)", color: "var(--status-danger-text)" },
};

export default function PaymentReceiptCard({
  payment,
}: {
  payment: TaskPayment;
}) {
  const { showToast } = useToast();
  const status = statusStyles[payment.status];
  const hash = payment.txHash;

  async function copyHash(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      showToast("Transaction hash copied", "success");
    } catch {
      showToast("Could not copy the transaction hash", "error");
    }
  }

  return (
    <tr>
      <td>{payment.agentName}</td>
      <td>{payment.capability ?? "—"}</td>
      <td>
        {payment.amountXLM.toLocaleString(undefined, {
          maximumFractionDigits: 7,
        })}
      </td>
      <td>
        {hash ? (
          <>
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${encodeURIComponent(hash)}`}
              target="_blank"
              rel="noopener noreferrer"
              title={hash}
              aria-label={`View transaction ${hash} on Stellar Expert`}
              className="font-mono underline"
            >
              {hash.length > 18
                ? `${hash.slice(0, 10)}…${hash.slice(-6)}`
                : hash}
            </a>{" "}
            <button
              type="button"
              className="receipt-action underline"
              onClick={() => void copyHash(hash)}
            >
              Copy
            </button>
          </>
        ) : (
          "—"
        )}
      </td>
      <td>
        <span className="chip" style={{ color: status.color }}>
          {status.label}
        </span>
      </td>
      <td>
        {payment.createdAt ? (
          <time dateTime={payment.createdAt}>
            {formatPaymentTimestamp(payment.createdAt)}
          </time>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}
