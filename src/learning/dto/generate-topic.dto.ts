import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class GenerateTopicDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  topic!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  detail?: string;
}
