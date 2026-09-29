import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';

@Component({
  selector: 'app-check-email',
  templateUrl: './check-email.html',
  styleUrl: './check-email.scss',
  imports: [Button, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckEmail {
  private readonly route = inject(ActivatedRoute);
  protected readonly email = () => this.route.snapshot.queryParamMap.get('email');
}
