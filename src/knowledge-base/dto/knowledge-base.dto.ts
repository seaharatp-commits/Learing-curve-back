import { IsString, MinLength } from "class-validator";

export class KnowledgeBaseDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  category!: string;

  @IsString()
  @MinLength(1)
  content!: string;
}
