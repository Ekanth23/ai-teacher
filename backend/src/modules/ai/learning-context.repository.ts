import * as curriculumRepository from "../curriculum/repository.js";
import * as studentRepository from "../student/repository.js";

/**
 * Read-only data sources for the US-118 assembler.  Keeping this adapter
 * separate makes it explicit that context assembly never writes academic or
 * AI data and gives tests a narrow seam for deterministic resolution.
 */
export const learningContextRepository = {
  getCurrentEnrollment: studentRepository.getCurrentEnrollmentForStudent,
  getAuthoritativeSyllabi: curriculumRepository.getAuthoritativeSyllabiForClass,
  getSyllabusLanguages: curriculumRepository.getSyllabusLanguages,
  findSubjects: curriculumRepository.findActiveSubjectsForClass,
  findCurriculumNodes: curriculumRepository.findActiveCurriculumNodes,
};

export type LearningContextRepository = typeof learningContextRepository;
