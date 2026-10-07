from sqlalchemy.ext.asyncio import AsyncSession

from ...models import TaskSet
from ..utils.commons import get_task_set_by_code_or_404, verify_task_in_set_or_404


async def resolve_task_context(
    db: AsyncSession, unique_link_code: str, task_id: int
) -> tuple[TaskSet, int]:
    task_set = await get_task_set_by_code_or_404(db, TaskSet, unique_link_code)
    await verify_task_in_set_or_404(db, task_set, task_id, visible_only=True)
    return task_set, task_id