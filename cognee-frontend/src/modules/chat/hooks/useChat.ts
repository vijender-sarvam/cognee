import { v4 } from "uuid";
import { useCallback, useState } from "react";
import { fetch, useBoolean } from "@/utils";
import { Dataset } from "@/modules/ingestion/useDatasets";

interface ChatMessage {
  id: string;
  user: "user" | "system";
  text: string;
}

const fetchMessages = () => {
  return fetch("/v1/search/")
    .then(response => response.json());
};

const sendMessage = (datasetName: string | null, message: string, searchType: string, topK: number) => {
  return fetch("/v1/search/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: message,
      searchType,
      ...(datasetName ? { datasets: [datasetName] } : {}),
      top_k: topK,
    }),
  })
    .then(response => response.json());
};

export default function useChat(dataset: Dataset) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const {
    value: isSearchRunning,
    setTrue: disableSearchRun,
    setFalse: enableSearchRun,
  } = useBoolean(false);

  const refreshChat = useCallback(async () => {
    const data = await fetchMessages();
    return setMessages(data);
  }, []);

  const handleMessageSending = useCallback((message: string, searchType: string, topK: number) => {
    const sentMessageId = v4();

    setMessages((messages) => [
      ...messages,
      {
        id: sentMessageId,
        user: "user",
        text: message,
      },
    ]);

    disableSearchRun();

    const datasetName = dataset.name || null;
    return sendMessage(datasetName, message, searchType, topK)
      .then(newMessages => {
        setMessages((messages) => [
          ...messages,
          ...newMessages.map((newMessage: string | []) => ({
            id: v4(),
            user: "system",
            text: convertToSearchTypeOutput(newMessage, searchType),
          })),
        ]);
      })
      .catch((error: { detail?: string; hint?: string; error?: string } | undefined) => {
        setMessages((messages) => {
          const withoutSent = messages.filter(msg => msg.id !== sentMessageId);
          const serverDetail = error?.detail || error?.error;
          const serverHint = error?.hint;
          const errorText = serverDetail
            ? `${serverDetail}${serverHint ? `\n\nHint: ${serverHint}` : ""}`
            : "Failed to send message. Please try again. If the issue persists, please contact support.";
          return [
            ...withoutSent,
            { id: v4(), user: "system", text: errorText },
          ];
        });
      })
      .finally(() => enableSearchRun());
  // dataset.name must be in deps so the latest selected dataset is captured
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disableSearchRun, enableSearchRun, dataset.name]);

  return {
    messages,
    refreshChat,
    sendMessage: handleMessageSending,
    isSearchRunning,
  };
}



// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertToSearchTypeOutput(systemMessage: any, searchType: string): string {
  // Access-control mode: each item is { dataset_id, dataset_name, dataset_tenant_id, search_result: <payload> }
  if (
    systemMessage &&
    typeof systemMessage === "object" &&
    !Array.isArray(systemMessage) &&
    "search_result" in systemMessage
  ) {
    return convertToSearchTypeOutput(systemMessage.search_result, searchType);
  }

  // Legacy non-AC mode for completion types: single-element array containing the answer string
  if (Array.isArray(systemMessage) && systemMessage.length === 1 && typeof systemMessage[0] === "string") {
    return systemMessage[0];
  }

  switch (searchType) {
    case "SUMMARIES":
    case "CHUNKS":
      if (Array.isArray(systemMessage)) {
        return systemMessage.map((m: { text?: string }) => m.text ?? "").join("\n");
      }
      // Non-AC mode: single payload object per map iteration
      if (typeof systemMessage === "object" && systemMessage !== null) {
        return systemMessage.text ?? JSON.stringify(systemMessage);
      }
      return String(systemMessage ?? "");
    default:
      if (typeof systemMessage === "string") return systemMessage;
      if (Array.isArray(systemMessage)) return systemMessage.join("\n");
      return JSON.stringify(systemMessage);
  }
}
