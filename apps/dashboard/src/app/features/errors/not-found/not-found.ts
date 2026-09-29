import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';

/**
 * A wrong URL says so.
 *
 * It used to redirect to Overview, which quietly hid typos and dead links —
 * and made a link shared from a deleted site look like it worked.
 */
@Component({
  selector: 'app-not-found',
  templateUrl: './not-found.html',
  styleUrl: './not-found.scss',
  imports: [RouterLink, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFound {
  private readonly location = inject(Location);
  protected back() {
    this.location.back();
  }
}
