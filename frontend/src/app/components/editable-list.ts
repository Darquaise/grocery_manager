import { Component, ElementRef, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';

import { TranslatePipe } from '@ngx-translate/core';

import { ListItem, ListStore } from '../models';

interface Row {
  id: number | null; // null = newly added, not yet saved
  name: string;
}

/**
 * A collapsible, editable list of named items (categories / locations).
 * Collapsed by default; an edit mode reveals drag handles for reordering,
 * inline rename and delete, and a single Save button below the list.
 */
@Component({
  selector: 'app-editable-list',
  imports: [FormsModule, CdkDropList, CdkDrag, CdkDragHandle, TranslatePipe],
  template: `
    <section class="ios-card">
      <button
        type="button"
        (click)="toggleExpand()"
        class="flex w-full items-center justify-between gap-2 px-4 py-3.5 text-left"
      >
        <span class="flex items-center gap-2">
          <span class="text-[17px] font-medium">{{ title() }}</span>
          <span class="rounded-full bg-fill px-2 py-0.5 text-xs text-label-2">
            {{ items().length }}
          </span>
        </span>
        <svg
          class="h-5 w-5 text-label-3 transition-transform"
          [class.rotate-180]="expanded()"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/>
        </svg>
      </button>

      @if (expanded()) {
        <div class="border-t border-separator px-4 py-3">
          @if (!editing()) {
            @if (items().length) {
              <ul class="divide-y divide-separator">
                @for (it of items(); track it.id) {
                  <li class="py-2.5 text-[17px]">{{ it.name }}</li>
                }
              </ul>
            } @else {
              <p class="py-2 text-[15px] text-label-2">{{ 'editableList.noEntries' | translate }}</p>
            }
            <button
              (click)="startEdit()"
              class="btn btn-secondary mt-3 w-full text-[15px]"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="m16.5 4.5 3 3L8 19l-4 1 1-4L16.5 4.5Z"/>
              </svg>
              {{ 'editableList.edit' | translate }}
            </button>
          } @else {
            <ul cdkDropList (cdkDropListDropped)="drop($event)" class="space-y-2">
              @for (row of working(); track $index) {
                <li
                  cdkDrag
                  class="flex items-center gap-1 rounded-[12px] bg-fill"
                >
                  <button
                    type="button"
                    cdkDragHandle
                    class="cursor-grab touch-none px-2 py-2 text-label-3 active:cursor-grabbing"
                    [attr.aria-label]="'editableList.move' | translate"
                  >
                    <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/>
                    </svg>
                  </button>
                  <input
                    [(ngModel)]="row.name"
                    [placeholder]="addPlaceholder()"
                    (keydown.enter)="addRow()"
                    class="min-w-0 flex-1 bg-transparent py-2 pr-1 text-[17px] focus:outline-none"
                  />
                  <button
                    (click)="removeRow($index)"
                    class="px-3 py-2 text-danger"
                    [attr.aria-label]="'editableList.delete' | translate"
                  >
                    <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18"/>
                    </svg>
                  </button>
                </li>
              }
            </ul>

            <button
              (click)="addRow()"
              class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-separator py-2 text-[15px] font-medium text-label-2"
            >
              <span class="text-lg leading-none">+</span> {{ 'editableList.addRow' | translate }}
            </button>

            <div class="mt-3 flex gap-2">
              <button (click)="cancelEdit()" class="btn btn-secondary flex-1 text-[15px]">{{ 'editableList.cancel' | translate }}</button>
              <button (click)="save()" [disabled]="saving()" class="btn btn-primary flex-1 text-[15px]">
                {{ 'editableList.save' | translate }}
              </button>
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class EditableListComponent implements OnInit {
  readonly title = input.required<string>();
  readonly store = input.required<ListStore>();
  readonly addPlaceholder = input('');

  readonly items = signal<ListItem[]>([]);
  readonly expanded = signal(false);
  readonly editing = signal(false);
  readonly working = signal<Row[]>([]);
  readonly saving = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngOnInit(): void {
    // Inputs (incl. the required `store`) are only available from ngOnInit on,
    // not in the constructor.
    void this.load();
  }

  private async load(): Promise<void> {
    this.items.set(await this.store().list());
  }

  toggleExpand(): void {
    const next = !this.expanded();
    this.expanded.set(next);
    if (!next) this.cancelEdit(); // collapsing discards an open edit
  }

  startEdit(): void {
    // Existing entries plus one empty row that's ready to type into.
    const rows: Row[] = this.items().map((it) => ({ id: it.id, name: it.name }));
    rows.push({ id: null, name: '' });
    this.working.set(rows);
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.working.set([]);
  }

  drop(event: CdkDragDrop<Row[]>): void {
    const rows = [...this.working()];
    moveItemInArray(rows, event.previousIndex, event.currentIndex);
    this.working.set(rows);
  }

  removeRow(index: number): void {
    this.working.set(this.working().filter((_, i) => i !== index));
  }

  /** Open a fresh empty row (via the + button or Enter) and focus it. */
  addRow(): void {
    this.working.set([...this.working(), { id: null, name: '' }]);
    setTimeout(() => {
      const inputs = this.host.nativeElement.querySelectorAll<HTMLInputElement>('[cdkDrag] input');
      inputs[inputs.length - 1]?.focus();
    });
  }

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      const rows = this.working();
      const store = this.store();
      const original = this.items();
      const origById = new Map(original.map((o) => [o.id, o]));
      // Rows are deleted only via the × button (i.e. removed from `rows`);
      // clearing a name just leaves that entry unchanged.
      const keepIds = new Set(rows.filter((r) => r.id != null).map((r) => r.id));

      for (const o of original) {
        if (!keepIds.has(o.id)) await store.remove(o.id);
      }
      // Creates + renames + reordering (sort_order = position).
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = row.name.trim();
        if (row.id == null) {
          if (name) await store.create(name, i);
          continue;
        }
        const orig = origById.get(row.id)!;
        const data: { name?: string; sort_order?: number } = {};
        if (name && orig.name !== name) data.name = name;
        if (orig.sort_order !== i) data.sort_order = i;
        if (Object.keys(data).length) await store.update(row.id, data);
      }

      await this.load();
      this.cancelEdit();
    } finally {
      this.saving.set(false);
    }
  }
}
