import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TeamsRepository } from './teams.repository';
import { CreateTeamDto, RenameTeamDto, SetMembersDto, SetSitesDto } from './dto';

@Injectable()
export class TeamsService {
  constructor(private readonly teams: TeamsRepository) {}

  list(organisationId: string) {
    return this.teams.listForOrganisation(organisationId);
  }

  async get(organisationId: string, id: string) {
    const team = await this.teams.find(organisationId, id);
    if (!team) throw new NotFoundException('No such team.');
    return team;
  }

  async create(organisationId: string, userId: string, dto: CreateTeamDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('A team needs a name.');

    const clash = await this.teams.findByName(organisationId, name);
    if (clash) throw new ConflictException(`A team called "${name}" already exists.`);

    return this.teams.create({ organisationId, userId, name });
  }

  async rename(organisationId: string, userId: string, id: string, dto: RenameTeamDto) {
    const team = await this.get(organisationId, id);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('A team needs a name.');

    // Renaming the default team is allowed — "Everyone" is a suggestion, and
    // `isDefault` is what the code keys on, not the name.
    if (name !== team.name) {
      const clash = await this.teams.findByName(organisationId, name);
      if (clash) throw new ConflictException(`A team called "${name}" already exists.`);
    }

    return this.teams.rename({ organisationId, userId, id, from: team.name, to: name });
  }

  /**
   * Delete a team.
   *
   * The default team is protected: every new site is granted to it, and
   * invitations add people to it, so deleting it would silently make new
   * sites admin-only with nothing to point at as the cause.
   */
  async remove(organisationId: string, userId: string, id: string) {
    const team = await this.get(organisationId, id);

    if (team.isDefault) {
      throw new ConflictException(
        'The default team cannot be deleted — new sites and new members are ' +
          'added to it. Rename it instead.',
      );
    }

    await this.teams.remove({
      organisationId,
      userId,
      id,
      name: team.name,
      members: team.members.length,
      sites: team.sites.length,
    });

    return { removed: true };
  }

  async setMembers(organisationId: string, userId: string, id: string, dto: SetMembersDto) {
    const team = await this.get(organisationId, id);

    // Silently dropping an id that belongs to another organisation would
    // look like a successful save that did not take effect.
    const valid = await this.teams.membersOf(organisationId, dto.memberIds);
    const unknown = dto.memberIds.filter((m) => !valid.includes(m));
    if (unknown.length) {
      throw new BadRequestException(
        `${unknown.length} of those people are not in this organisation.`,
      );
    }

    return this.teams.setMembers({
      organisationId,
      userId,
      teamId: id,
      teamName: team.name,
      memberIds: [...new Set(dto.memberIds)],
    });
  }

  async setSites(organisationId: string, userId: string, id: string, dto: SetSitesDto) {
    const team = await this.get(organisationId, id);

    const valid = await this.teams.sitesOf(organisationId, dto.siteIds);
    const unknown = dto.siteIds.filter((s) => !valid.includes(s));
    if (unknown.length) {
      throw new BadRequestException(
        `${unknown.length} of those sites are not in this organisation.`,
      );
    }

    return this.teams.setSites({
      organisationId,
      userId,
      teamId: id,
      teamName: team.name,
      siteIds: [...new Set(dto.siteIds)],
    });
  }
}
