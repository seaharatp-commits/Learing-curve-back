import { IsEnum, IsString, MinLength } from "class-validator";

export enum IssuePriorityDto {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
}

export class CreateIssueDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsString()
  @MinLength(1)
  category!: string;

  @IsEnum(IssuePriorityDto)
  priority!: IssuePriorityDto;
}
