import { IsString, MinLength } from "class-validator";

export class GenerateKnowledgeDto {
  @IsString()
  @MinLength(10)
  text!: string;
}
