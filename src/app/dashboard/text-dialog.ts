import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-text-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p class="dialog-text">{{ data.text }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-text {
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.6;
      font-size: 14px;
    }
  `],
})
export class TextDialogComponent {
  data = inject<{ title: string; text: string }>(MAT_DIALOG_DATA);
}
