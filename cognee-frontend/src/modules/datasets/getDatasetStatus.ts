import { fetch } from "@/utils";

export type DatasetProcessingStatus =
  | "DATASET_PROCESSING_INITIATED"
  | "DATASET_PROCESSING_STARTED"
  | "DATASET_PROCESSING_COMPLETED"
  | "DATASET_PROCESSING_ERRORED";

/** GET /v1/datasets/status?dataset=<id>[&dataset=<id>...] */
export async function getDatasetStatus(
  datasetIds: string[],
): Promise<Record<string, DatasetProcessingStatus>> {
  const query = datasetIds.map((id) => `dataset=${encodeURIComponent(id)}`).join("&");
  return fetch(`/v1/datasets/status?${query}`, { method: "GET" }).then((r) => r.json());
}

const TERMINAL = new Set<DatasetProcessingStatus>([
  "DATASET_PROCESSING_COMPLETED",
  "DATASET_PROCESSING_ERRORED",
]);

/**
 * Poll the dataset status endpoint until the pipeline reaches a terminal state.
 *
 * @param datasetId   UUID of the dataset to track.
 * @param intervalMs  How often to poll (default 4 s).
 * @param onStatus    Called on every poll with the current status string.
 * @returns           A cancel function — call it to stop polling early.
 */
export function pollDatasetStatus(
  datasetId: string,
  onStatus: (status: DatasetProcessingStatus) => void,
  intervalMs = 4000,
): () => void {
  let cancelled = false;

  async function tick() {
    while (!cancelled) {
      try {
        const result = await getDatasetStatus([datasetId]);
        const status = result[datasetId];

        if (status) {
          onStatus(status);
          if (TERMINAL.has(status)) break;
        }
      } catch {
        // Network blip — keep polling
      }

      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  tick();

  return () => {
    cancelled = true;
  };
}
