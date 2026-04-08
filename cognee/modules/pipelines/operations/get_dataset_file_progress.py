from uuid import UUID

from sqlalchemy import select

from cognee.infrastructure.databases.relational import get_relational_engine
from cognee.modules.data.models.Data import Data
from cognee.modules.data.models.DatasetData import DatasetData


async def get_dataset_file_progress(
    dataset_ids: list[UUID],
) -> dict[str, dict[str, int]]:
    """Return ``{dataset_id: {total_files, completed_files}}`` for each dataset.

    A file is considered *completed* when every pipeline recorded in its
    ``pipeline_status`` JSON marks the dataset as done.
    """
    if not dataset_ids:
        return {}

    db_engine = get_relational_engine()

    async with db_engine.get_async_session() as session:
        rows = (
            await session.execute(
                select(DatasetData.dataset_id, Data.pipeline_status)
                .join(Data, Data.id == DatasetData.data_id)
                .filter(DatasetData.dataset_id.in_(dataset_ids))
            )
        ).all()

    progress: dict[str, dict[str, int]] = {}
    for ds_id, ps in rows:
        key = str(ds_id)
        entry = progress.setdefault(key, {"total_files": 0, "completed_files": 0})
        entry["total_files"] += 1

        if not ps:
            continue

        completed = all(
            isinstance(datasets, dict) and datasets.get(key) == "DATA_ITEM_PROCESSING_COMPLETED"
            for datasets in ps.values()
        )
        if completed:
            entry["completed_files"] += 1

    for ds_id in dataset_ids:
        progress.setdefault(str(ds_id), {"total_files": 0, "completed_files": 0})

    return progress
