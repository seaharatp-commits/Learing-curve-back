import { IsString, MaxLength, MinLength } from "class-validator";

export class GenerateKnowledgeDto {
  @IsString()
  @MinLength(10)
  @MaxLength(12000)
  text!: string;
}
