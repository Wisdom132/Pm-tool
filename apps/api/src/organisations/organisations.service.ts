import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganisationsRepository } from './organisations.repository';
import { DeleteOrganisationDto, RenameOrganisationDto } from './dto';

@Injectable()
export class OrganisationsService {
  constructor(private readonly organisations: OrganisationsRepository) {}

  async get(id: string) {
    const organisation = await this.organisations.find(id);
    if (!organisation) throw new NotFoundException('No such organisation.');
    return organisation;
  }

  async rename(id: string, userId: string, dto: RenameOrganisationDto) {
    const organisation = await this.get(id);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('An organisation needs a name.');

    // The slug is deliberately not regenerated: it may already be in links,
    // and silently changing it would break them.
    return this.organisations.rename({ id, userId, from: organisation.name, to: name });
  }

  async remove(id: string, userId: string, dto: DeleteOrganisationDto) {
    const organisation = await this.get(id);

    if (dto.confirm.trim() !== organisation.name) {
      throw new BadRequestException(
        `Type "${organisation.name}" to confirm. This removes every site, team and connection in it.`,
      );
    }

    // Provider connections are the part that cannot be undone by
    // un-deleting a row: the installation lives on GitHub's side. Making
    // the admin revoke them first means the irreversible step is explicit.
    const connections = await this.organisations.countLiveConnections(id);
    if (connections > 0) {
      throw new ConflictException(
        `${connections} provider connection(s) are still active. Revoke them first — ` +
          'deleting the organisation does not uninstall the app from your repositories.',
      );
    }

    await this.organisations.softDelete({ id, userId, name: organisation.name });

    return { deleted: true };
  }
}
