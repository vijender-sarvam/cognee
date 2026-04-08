import { useCallback, useEffect, useRef, useState } from 'react';

import { fetch } from '@/utils';
import { DataFile } from './useData';
import createDataset from "../datasets/createDataset";

export type DatasetStatus =
  | "DATASET_PROCESSING_INITIATED"
  | "DATASET_PROCESSING_STARTED"
  | "DATASET_PROCESSING_COMPLETED"
  | "DATASET_PROCESSING_ERRORED"
  | "";

export interface Dataset {
  id: string;
  name: string;
  data: DataFile[];
  status: DatasetStatus;
}

const PROCESSING_STATUSES = new Set<DatasetStatus>([
  "DATASET_PROCESSING_INITIATED",
  "DATASET_PROCESSING_STARTED",
]);

function useDatasets(useCloud = false) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchDatasetStatuses = useCallback(
    async (currentDatasets: Dataset[]) => {
      if (!currentDatasets.length) return;

      const query = currentDatasets
        .map((d) => `dataset=${encodeURIComponent(d.id)}`)
        .join("&");

      try {
        const statuses: Record<string, DatasetStatus> = await fetch(
          `/v1/datasets/status?${query}`,
          { headers: { "Content-Type": "application/json" } },
          useCloud,
        ).then((r) => r.json());

        setDatasets((prev) =>
          prev.map((d) => ({
            ...d,
            status: statuses[d.id] ?? d.status,
          })),
        );

        const hasProcessing = currentDatasets.some((d) =>
          PROCESSING_STATUSES.has(statuses[d.id]),
        );

        if (hasProcessing) {
          statusTimerRef.current = setTimeout(
            () => fetchDatasetStatuses(currentDatasets),
            4000,
          );
        }
      } catch {
        // Network blip — retry after a longer delay
        statusTimerRef.current = setTimeout(
          () => fetchDatasetStatuses(currentDatasets),
          8000,
        );
      }
    },
    [useCloud],
  );

  useEffect(() => {
    return () => {
      if (statusTimerRef.current !== null) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
    };
  }, []);

  const addDataset = useCallback((datasetName: string) => {
    return createDataset({ name: datasetName  }, useCloud)
      .then((dataset) => {
        setDatasets((datasets) => [
          ...datasets,
          dataset,
        ]);
      });
  }, [useCloud]);

  const removeDataset = useCallback((datasetId: string) => {
    return fetch(`/v1/datasets/${datasetId}`, {
      method: 'DELETE',
    }, useCloud)
      .then(() => {
        setDatasets((datasets) =>
          datasets.filter((dataset) => dataset.id !== datasetId)
        );
      });
  }, [useCloud]);

  const fetchDatasets = useCallback(() => {
    return fetch('/v1/datasets', {
        headers: {
          "Content-Type": "application/json",
        },
      }, useCloud)
      .then((response) => response.json())
      .then((datasets: Dataset[]) => {
        setDatasets(datasets);

        if (datasets.length > 0) {
          fetchDatasetStatuses(datasets);
        }

        return datasets;
      })
      .catch((error) => {
        console.error('Error fetching datasets:', error);
        throw error;
      });
  }, [useCloud, fetchDatasetStatuses]);

  const refreshStatuses = useCallback(() => {
    setDatasets((current) => {
      if (current.length > 0) fetchDatasetStatuses(current);
      return current;
    });
  }, [fetchDatasetStatuses]);

  const getDatasetData = useCallback((datasetId: string) => {
    return fetch(`/v1/datasets/${datasetId}/data`, {}, useCloud)
      .then((response) => response.json())
      .then((data) => {
        setDatasets((prev) =>
          prev.map((d) => (d.id === datasetId ? { ...d, data } : d)),
        );
        return data;
      });
  }, [useCloud]);

  const removeDatasetData = useCallback((datasetId: string, dataId: string) => {
    return fetch(`/v1/datasets/${datasetId}/data/${dataId}`, {
      method: 'DELETE',
    }, useCloud);
  }, [useCloud]);

  return {
    datasets,
    addDataset,
    removeDataset,
    getDatasetData,
    removeDatasetData,
    refreshDatasets: fetchDatasets,
    refreshStatuses,
  };
}

export default useDatasets;
