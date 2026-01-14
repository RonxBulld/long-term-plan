/**
 * Convert parsed tasks into a stable, minimal output shape for `plan.get (tree)`.
 */
export function buildTaskTreeView(rootTasks, options) {
    const out = [];
    const stack = [];
    // Seed the stack in reverse so we push into `out` in the original order.
    for (let index = rootTasks.length - 1; index >= 0; index -= 1) {
        const task = rootTasks[index];
        if (!task)
            continue;
        stack.push({ task, outArray: out });
    }
    while (stack.length > 0) {
        const frame = stack.pop();
        if (!frame)
            continue;
        const task = frame.task;
        const node = {
            id: task.id,
            title: task.title,
            status: task.status,
            sectionPath: task.sectionPath,
            parentId: task.parentId,
            hasBody: task.hasBody,
            children: [],
        };
        if (options.includeBody && task.hasBody)
            node.bodyMarkdown = task.bodyMarkdown;
        frame.outArray.push(node);
        // Push children in reverse so traversal preserves the original order.
        for (let index = task.children.length - 1; index >= 0; index -= 1) {
            const child = task.children[index];
            if (!child)
                continue;
            stack.push({ task: child, outArray: node.children });
        }
    }
    return out;
}
export function toTaskFlatRow(task, options) {
    const row = {
        id: task.id,
        title: task.title,
        status: task.status,
        sectionPath: task.sectionPath,
        parentId: task.parentId,
        hasBody: task.hasBody,
    };
    if (options.includeBody && task.hasBody)
        row.bodyMarkdown = task.bodyMarkdown;
    return row;
}
//# sourceMappingURL=view.js.map