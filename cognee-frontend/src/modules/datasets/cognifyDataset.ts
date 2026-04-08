import { fetch } from "@/utils";
import { Dataset } from "../ingestion/useDatasets";

/**
 * Kick off the cognify pipeline for a dataset in background mode.
 *
 * The API returns immediately with per-dataset PipelineRunStarted info
 * (including pipeline_run_id). Use getDatasetStatus() to poll for completion.
 */
export default async function cognifyDataset(
  dataset: Dataset,
  useCloud: boolean = false,
  chunkSize?: number,
  skipGraph: boolean = false,
  documentParser?: string,
  parserOptions?: Record<string, string>,
): Promise<Record<string, { status: string; pipeline_run_id: string }>> {
  return fetch(
    "/v1/cognify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        datasetIds: [dataset.id],
        runInBackground: true,
        ...(chunkSize ? { chunk_size: chunkSize } : {}),
        ...(skipGraph ? { skip_graph: true } : {}),
        ...(documentParser ? { document_parser: documentParser } : {}),
        ...(parserOptions && Object.keys(parserOptions).length
          ? { parser_options: parserOptions }
          : {}),
      }),
    },
    useCloud,
  ).then((response) => response.json());
}
