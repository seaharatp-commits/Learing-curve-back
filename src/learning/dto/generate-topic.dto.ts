import { IsString, MaxLength, MinLength } from "class-validator";

export class GenerateTopicDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  topic!: string;
}
