import { ReactNode, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, TouchSensor,
  useSensor, useSensors, useDraggable, useDroppable, closestCorners,
  DragStartEvent, DragEndEvent,
} from "@dnd-kit/core";
import { useI18n } from "../context/I18nContext";

export interface KanbanColumn {
  id: string;
  title: string;
  accent?: string; // tailwind bg-* class for the column dot/strip
}

function Card({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`cursor-grab touch-none rounded-lg border border-paper-200 bg-white p-3 shadow-sm outline-none transition active:cursor-grabbing hover:shadow-raised focus-visible:ring-2 focus-visible:ring-amber-500 ${isDragging ? "opacity-40" : ""}`}
    >
      {children}
    </div>
  );
}

function Column({
  col, count, summary, children,
}: {
  col: KanbanColumn; count: number; summary?: ReactNode; children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${col.accent || "bg-ink-500"}`} />
          <span className="text-sm font-semibold text-ink-800">{col.title}</span>
          <span className="kpi-num rounded-full bg-paper-200 px-2 py-0.5 text-[11px] text-ink-500">{count}</span>
        </div>
        {summary}
      </div>
      <div
        ref={setNodeRef}
        className={`flex min-h-[120px] flex-1 flex-col gap-2 rounded-xl2 border-2 border-dashed p-2 transition-colors ${
          isOver ? "border-amber-500/50 bg-amber-50/50" : "border-transparent bg-paper-200/40"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function KanbanBoard<T>({
  columns, items, itemKey, itemColumn, onMove, renderCard, columnSummary,
}: {
  columns: KanbanColumn[];
  items: T[];
  itemKey: (item: T) => string;
  itemColumn: (item: T) => string;
  onMove: (item: T, toColumn: string) => void;
  renderCard: (item: T) => ReactNode;
  columnSummary?: (items: T[]) => ReactNode;
}) {
  const { tr } = useI18n();
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor)
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    const item = items.find((i) => itemKey(i) === String(e.active.id));
    if (item && itemColumn(item) !== overId) onMove(item, overId);
  };

  const activeItem = activeId ? items.find((i) => itemKey(i) === activeId) : null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const colItems = items.filter((i) => itemColumn(i) === col.id);
          return (
            <Column key={col.id} col={col} count={colItems.length} summary={columnSummary?.(colItems)}>
              {colItems.length === 0 ? (
                <div className="grid flex-1 place-items-center rounded-lg py-6 text-center text-xs text-ink-400">
                  {tr("kanban_drop")}
                </div>
              ) : (
                colItems.map((item) => (
                  <Card key={itemKey(item)} id={itemKey(item)}>{renderCard(item)}</Card>
                ))
              )}
            </Column>
          );
        })}
      </div>
      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(.2,0,.38,.9)" }}>
        {activeItem ? (
          <div className="rotate-2 rounded-lg border border-amber-500/40 bg-white p-3 shadow-overlay">
            {renderCard(activeItem)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
